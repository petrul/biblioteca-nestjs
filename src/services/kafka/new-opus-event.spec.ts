import { KafkaListenerService } from './listener.service';
import { EnrichmentKafkaListenerService } from './enrichment-listener.service';
import { Util } from '../../util';

/**
 * Both KafkaListenerService (vectorizing) and EnrichmentKafkaListenerService
 * (enrichment) are independent consumers of the same newOpusImportedTopic,
 * in their own separate consumer groups (see enrichment-listener.service.ts's
 * own comment on why that separation matters). This exercises both against
 * the same simulated event end to end - real classes, everything they talk
 * to (Kafka, BibliotecaClient, VectorizerService, EnrichmentService) faked -
 * to prove a single new-opus event actually reaches both, and that
 * enrichment's own "already enriched?" guards behave correctly on both the
 * opus and the author.
 */
describe('a new opus Kafka event', () => {
  let delaySpy: jest.SpyInstance;

  beforeAll(() => {
    // Both listeners deliberately wait 2s before touching a freshly
    // imported opus (see their own "not always ready immediately" comment) -
    // real production behavior, dead weight in a unit test.
    delaySpy = jest.spyOn(Util, 'delay').mockResolvedValue(undefined as any);
  });

  afterAll(() => {
    delaySpy.mockRestore();
  });

  function fakeConsumer() {
    const consumer: any = {
      connect: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      run: jest.fn(async ({ eachMessage }: any) => { consumer.eachMessage = eachMessage; }),
    };
    return consumer;
  }

  function fakeKafkaService(consumer: any) {
    return { kafka: { consumer: jest.fn(() => consumer) } } as any;
  }

  const sharedConfig: any = {
    kafka: {
      newOpusImportedTopic: 'biblioteca_newOpusImportedTopic',
      opusReimportedTopic: 'biblioteca_opusReimportedTopic',
      opusRemovedTopic: 'biblioteca_opusRemovedTopic',
    },
  };

  function fakePayload(path: string) {
    return {
      topic: sharedConfig.kafka.newOpusImportedTopic,
      partition: 0,
      message: { value: Buffer.from(JSON.stringify({ path, id: 999 })) },
      heartbeat: jest.fn().mockResolvedValue(undefined),
    };
  }

  // Wires up both real listener services against fully mocked
  // dependencies, and drives both consumers' eachMessage handlers with the
  // same simulated event - returns the mocks so each test can set up its
  // own opus fixture (the author is embedded in the opus, exactly as the
  // server's single-div response carries it: an AuthorDto with bio
  // present-or-null) and assert on the calls made against them.
  async function bootBothListeners(opus: any) {
    const tbc: any = {
      getElemByPath: jest.fn().mockResolvedValue(opus),
      getAuthors: jest.fn().mockResolvedValue([]),
    };
    const vectorizer: any = { vectorize: jest.fn().mockResolvedValue(undefined) };
    const enrichment: any = {
      enrichWork: jest.fn().mockResolvedValue(undefined),
      enrichAuthor: jest.fn().mockResolvedValue(undefined),
    };

    const vectorizingConsumer = fakeConsumer();
    const vectorizingListener = new KafkaListenerService(
      fakeKafkaService(vectorizingConsumer),
      tbc,
      vectorizer,
      { kafkaGroupId: 'biblioteca_nestjs' } as any,
      sharedConfig,
    );
    await vectorizingListener.initKafkaListener();

    const enrichmentConsumer = fakeConsumer();
    const enrichmentListener = new EnrichmentKafkaListenerService(
      fakeKafkaService(enrichmentConsumer),
      tbc,
      enrichment,
      sharedConfig,
    );
    await enrichmentListener.initKafkaListener();

    const payload = fakePayload(opus.path);
    await vectorizingConsumer.eachMessage(payload);
    await enrichmentConsumer.eachMessage(fakePayload(opus.path));

    return { tbc, vectorizer, enrichment };
  }

  it('vectorizes and enriches both a not-yet-enriched opus and its not-yet-enriched author', async () => {
    const opus = { id: 999, path: 'eminescu/poezii', head: 'Poezii', author: { strId: 'eminescu', displayName: 'Mihai Eminescu' } };

    const { tbc, vectorizer, enrichment } = await bootBothListeners(opus);

    expect(vectorizer.vectorize).toHaveBeenCalledWith(999, expect.any(Function));
    expect(enrichment.enrichWork).toHaveBeenCalledWith(opus);
    expect(enrichment.enrichAuthor).toHaveBeenCalledWith(opus.author);
    // The embedded author already answers the already-enriched question -
    // the listener must not need the whole authors list for it.
    expect(tbc.getAuthors).not.toHaveBeenCalled();
  });

  it('still vectorizes and enriches the opus, but skips an author who is already enriched', async () => {
    const opus = {
      id: 999, path: 'eminescu/poezii', head: 'Poezii',
      author: { strId: 'eminescu', displayName: 'Mihai Eminescu', bio: 'Already has a bio from a previous sweep.' },
    };

    const { vectorizer, enrichment } = await bootBothListeners(opus);

    expect(vectorizer.vectorize).toHaveBeenCalledWith(999, expect.any(Function));
    expect(enrichment.enrichWork).toHaveBeenCalledWith(opus);
    expect(enrichment.enrichAuthor).not.toHaveBeenCalled();
  });

  it('still vectorizes and enriches the author, but skips an opus that is already enriched (summarySourceUrl marker)', async () => {
    // The real single-div response carries summarySourceUrl, not summary
    // (the LOB is @JsonIgnore'd) - this is the case a replayed event hits.
    const opus = {
      id: 999, path: 'eminescu/poezii', head: 'Poezii',
      summarySourceUrl: 'https://en.wikipedia.org/wiki/Poezii',
      author: { strId: 'eminescu', displayName: 'Mihai Eminescu' },
    };

    const { vectorizer, enrichment } = await bootBothListeners(opus);

    expect(vectorizer.vectorize).toHaveBeenCalledWith(999, expect.any(Function));
    expect(enrichment.enrichWork).not.toHaveBeenCalled();
    expect(enrichment.enrichAuthor).toHaveBeenCalledWith(opus.author);
  });

  it('still vectorizes and enriches the author, but skips an opus that is already enriched (summary field)', async () => {
    const opus = {
      id: 999, path: 'eminescu/poezii', head: 'Poezii',
      summary: 'Already has a summary.',
      author: { strId: 'eminescu', displayName: 'Mihai Eminescu' },
    };

    const { vectorizer, enrichment } = await bootBothListeners(opus);

    expect(vectorizer.vectorize).toHaveBeenCalledWith(999, expect.any(Function));
    expect(enrichment.enrichWork).not.toHaveBeenCalled();
    expect(enrichment.enrichAuthor).toHaveBeenCalledWith(opus.author);
  });
});
