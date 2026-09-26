import { KafkaListenerService } from './listener.service';
import { KafkaService } from './kafka.service';
import { BibliotecaClient } from '../biblioteca_client.service';
import { VectorizerService } from '../vectorizer.service';
import {
    SharedTextbaseConfig,
    VectorizerConfiguration,
} from 'src/configuration';
import { Util } from 'src/util';

/**
 * Unit test for the 404-vs-retryable decision in KafkaListenerService's
 * eachMessage loop - Kafka, biblioteca-server and the vectorizer are all
 * mocked, so nothing here touches the network.
 *
 * The generated client throws the raw (fetch) Response on non-OK, so the
 * listener sees the HTTP status directly on the thrown object: 404 means
 * the opus is gone for good (skip, commit the offset by returning from
 * eachMessage) while anything else - 5xx outages included - must be
 * retried without committing.
 */
describe('KafkaListenerService', () => {

    const OPUS_PATH = '/en/gutenberg/saint_amand,imbert_de-the_happy_days_of_empress_marie_louise.xml';
    const OPUS_EVENT = { path: OPUS_PATH };

    // returned by the mocked BibliotecaClient once the opus turns out to exist
    const FETCHED_OPUS = { id: 42, path: OPUS_PATH };

    let delaySpy: jest.SpyInstance;
    let eachMessage: (payload: any) => Promise<void>;
    let consumer: any;
    let getElemByPath: jest.Mock;
    let removeOpus: jest.Mock;
    let vectorize: jest.Mock;
    let heartbeat: jest.Mock;

    const buildListener = () => {
        consumer = {
            connect: jest.fn().mockResolvedValue(undefined),
            subscribe: jest.fn().mockResolvedValue(undefined),
            run: jest.fn().mockImplementation(({ eachMessage: h }) => { eachMessage = h; }),
            disconnect: jest.fn().mockResolvedValue(undefined),
        };
        const ks = { kafka: { consumer: jest.fn(() => consumer) } } as unknown as KafkaService;
        getElemByPath = jest.fn();
        const tbc = { getElemByPath } as unknown as BibliotecaClient;
        removeOpus = jest.fn().mockResolvedValue(undefined);
        vectorize = jest.fn().mockResolvedValue(0);
        const vec = { removeOpus, vectorize } as unknown as VectorizerService;

        const conf = {
            kafkaServers: 'test:9092',
            kafkaGroupId: 'test-group',
            sentenceTransformersServer: 'test:1234',
            ollamaServer: 'test:11434',
            vectorStoreUrl: 'test:19530',
            bibliotecaUrl: 'http://test:8080',
        } as VectorizerConfiguration;
        const sharedConfig: SharedTextbaseConfig = {
            kafka: {
                newOpusImportedTopic: 'test-opus-new',
                opusReimportedTopic: 'test-opus-reimported',
                opusRemovedTopic: 'test-opus-removed',
            },
            milvus: { collection: 'test-collection' },
            embedder: { model: 'TEST', dimension: 3 },
            paragraph: { minChars: 20, maxChars: 3000 },
        };

        const listener = new KafkaListenerService(
            ks, tbc, vec,
            conf,
            sharedConfig,
        );
        return listener.initKafkaListener();
    };

    const consumeImported = () => {
        heartbeat = jest.fn().mockResolvedValue(undefined);
        return eachMessage({
            topic: 'test-opus-new',
            partition: 0,
            message: { value: Buffer.from(JSON.stringify(OPUS_EVENT)) },
            heartbeat,
        });
    };

    beforeEach(async () => {
        // production waits 2s before each attempt and 10s between retries;
        // the unit test collapses both to immediate microtask continuations
        delaySpy = jest.spyOn(Util, 'delay').mockResolvedValue(undefined);
        await buildListener();
    });

    afterEach(() => {
        delaySpy.mockRestore();
    });

    it('is wired to the expected topics with its own consumer', () => {
        expect(consumer.subscribe).toHaveBeenCalledWith({
            topics: ['test-opus-new', 'test-opus-removed'],
            fromBeginning: true,
        });
        expect(typeof eachMessage).toBe('function');
    });

    it.each([404, 400])('skips the event when the server answers %s - offset commits, no retry, no vectorizing', async (status) => {
      // 404: the opus is gone (deleted book, or re-import removed it).
      // 400: the server rejects the request for good - seen in production
      // with legacy pre-/author/opus event paths (getByPath's shape guard).
      // The generated client throws the raw Response on non-OK either way.
      getElemByPath.mockRejectedValue({ status, ok: false });

      await consumeImported(); // must settle - falling out of eachMessage lets KafkaJS commit the offset

      expect(getElemByPath).toHaveBeenCalledTimes(1);
      expect(removeOpus).toHaveBeenCalledTimes(1); // the pre-vectorizing purge still ran
      expect(removeOpus).toHaveBeenCalledWith(OPUS_PATH);
      expect(vectorize).not.toHaveBeenCalled();
      expect(delaySpy).not.toHaveBeenCalledWith(10 * 1000); // no retry back-off happened
    });

    it.each([404])('also skips a 404 raised while fetching paragraphs', async () => {
        // a 404 can also surface later, e.g. the opus is deleted between
        // getElemByPath and the first paragraph page - same verdict
        getElemByPath.mockResolvedValue(FETCHED_OPUS);
        vectorize.mockRejectedValue({ status: 404, ok: false });

        await consumeImported();

        expect(vectorize).toHaveBeenCalledTimes(1);
        expect(delaySpy).not.toHaveBeenCalledWith(10 * 1000);
    });

    it.each([500, 503])('retries a %s without committing the offset, then succeeds when the server recovers', async (status) => {
        getElemByPath
            .mockRejectedValueOnce({ status, ok: false })
            .mockRejectedValueOnce({ status, ok: false })
            .mockResolvedValueOnce(FETCHED_OPUS);

        await consumeImported(); // only settles because the 3rd attempt succeeds

        expect(getElemByPath).toHaveBeenCalledTimes(3);
        expect(delaySpy).toHaveBeenCalledWith(10 * 1000); // the retry back-off was used
        expect(delaySpy).toHaveBeenCalledTimes(5); // 2s before each of the 3 attempts + 2 back-offs
        expect(vectorize).toHaveBeenCalledTimes(1);
        expect(vectorize).toHaveBeenCalledWith(42, expect.any(Function));
    });

    it('keeps retrying a persistent outage - eachMessage never settles while the server is down', async () => {
        getElemByPath.mockRejectedValue({ status: 503, ok: false });

        const pending = consumeImported();
        let settled = false;
        pending.then(() => { settled = true; }).catch(() => { settled = true; });

        // let a few retry iterations spin - all awaits are resolved promises, so this is pure microtask work
        for (let i = 0; i < 25; i++) {
            await Promise.resolve();
        }

        expect(settled).toBe(false); // offset not committed - KafkaJS still owns the message
        expect(getElemByPath.mock.calls.length).toBeGreaterThan(1);

        // let the loop make one more full attempt so the pending promise can be
        // drained deterministically below without leaving a spinning loop behind
        getElemByPath.mockResolvedValue(FETCHED_OPUS);
        await pending;
    });
});
