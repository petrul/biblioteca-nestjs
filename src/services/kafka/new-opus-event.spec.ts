import { VectorizerKafkaListenerService } from './vectorizer-listener.service';
import { AuthorEnrichmentKafkaListenerService } from './author-enrichment-listener.service';
import { Util } from '../../util';

/**
 * Both VectorizerKafkaListenerService (vectorizing) and
 * AuthorEnrichmentKafkaListenerService (author enrichment) are independent
 * consumers of the same newOpusImportedTopic, in their own separate consumer
 * groups (see author-enrichment-listener.service.ts's own comment on why
 * that separation matters). This exercises both against the same simulated
 * event end to end - real classes, everything they talk to (Kafka,
 * BibliotecaClient, VectorizerService, EnrichmentService) faked - to prove
 * a single new-opus event actually reaches both, and that the enrichment
 * listener only ever enriches the event's AUTHOR, never the work itself
 * (works are dailySweep()'s job), and skips authors already carrying a bio.
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
      // The real service returns the author's retrieved image URLs -
      // the listener threads the first into the cover order.
      enrichAuthor: jest.fn().mockResolvedValue(['https://upload.wikimedia.org/eminescu.jpg']),
      // The stored-portrait fallback when no fresh art was retrieved.
      storedAuthorArt: jest.fn().mockResolvedValue(undefined),
    };
    const covers: any = { enqueue: jest.fn() };

    const vectorizingConsumer = fakeConsumer();
    const vectorizingListener = new VectorizerKafkaListenerService(
      fakeKafkaService(vectorizingConsumer),
      tbc,
      vectorizer,
      { kafkaGroupId: 'biblioteca_nestjs' } as any,
      sharedConfig,
    );
    await vectorizingListener.initKafkaListener();

    const enrichmentConsumer = fakeConsumer();
    const enrichmentListener = new AuthorEnrichmentKafkaListenerService(
      fakeKafkaService(enrichmentConsumer),
      tbc,
      enrichment,
      covers,
      sharedConfig,
    );
    await enrichmentListener.initKafkaListener();

    const payload = fakePayload(opus.path);
    await vectorizingConsumer.eachMessage(payload);
    await enrichmentConsumer.eachMessage(fakePayload(opus.path));

    return { tbc, vectorizer, enrichment, covers };
  }

  it('vectorizes and enriches the not-yet-enriched author - and only the author, never the work', async () => {
    const opus = { id: 999, path: 'eminescu/poezii', head: 'Poezii', author: { strId: 'eminescu', displayName: 'Mihai Eminescu' } };

    const { tbc, vectorizer, enrichment, covers } = await bootBothListeners(opus);

    expect(vectorizer.vectorize).toHaveBeenCalledWith(999, expect.any(Function));
    expect(enrichment.enrichAuthor).toHaveBeenCalledWith(opus.author);
    // the cover order carries the art the author enrichment just retrieved
    expect(covers.enqueue).toHaveBeenCalledWith(expect.objectContaining({ path: opus.path, id: opus.id, artUrl: 'https://upload.wikimedia.org/eminescu.jpg' }));
    // The listener is author-only by design: the work's own summary
    // enrichment belongs to EnrichmentService.dailySweep(), so a fresh
    // unenriched opus must NOT trigger enrichWork here.
    expect(enrichment.enrichWork).not.toHaveBeenCalled();
    // The embedded author already answers the already-enriched question -
    // the listener must not need the whole authors list for it.
    expect(tbc.getAuthors).not.toHaveBeenCalled();
  });

  it('still vectorizes, but skips an author who is already enriched', async () => {
    const opus = {
      id: 999, path: 'eminescu/poezii', head: 'Poezii',
      author: { strId: 'eminescu', displayName: 'Mihai Eminescu', bio: 'Already has a bio from a previous sweep.' },
    };

    const { vectorizer, enrichment, covers } = await bootBothListeners(opus);

    expect(vectorizer.vectorize).toHaveBeenCalledWith(999, expect.any(Function));
    expect(enrichment.enrichAuthor).not.toHaveBeenCalled();
    expect(covers.enqueue).toHaveBeenCalledWith(expect.objectContaining({ path: opus.path }));
    // already enriched -> no enrichment ran -> the cover orders art-less
    expect((covers.enqueue as jest.Mock).mock.calls[0][0].artUrl).toBeUndefined();
    expect(enrichment.enrichWork).not.toHaveBeenCalled();
  });

  it('does not enrich the work even when the opus carries already-enriched markers', async () => {
    // The real single-div response carries work-level metadata; this
    // listener does not enrich works directly.
    // listener: it never enriches works, enriched or not.
    const opus = {
      id: 999, path: 'eminescu/poezii', head: 'Poezii',
      description: 'Already enriched.',
      author: { strId: 'eminescu', displayName: 'Mihai Eminescu' },
    };

    const { vectorizer, enrichment, covers } = await bootBothListeners(opus);

    expect(vectorizer.vectorize).toHaveBeenCalledWith(999, expect.any(Function));
    expect(enrichment.enrichWork).not.toHaveBeenCalled();
    expect(enrichment.enrichAuthor).toHaveBeenCalledWith(opus.author);
    expect(covers.enqueue).toHaveBeenCalledWith(expect.objectContaining({ path: opus.path }));
  });

  it('enriches nothing when the event carries no author', async () => {
    const opus = { id: 999, path: 'anonymous/fragment', head: 'Fragment' };

    const { vectorizer, enrichment, covers } = await bootBothListeners(opus);

    expect(vectorizer.vectorize).toHaveBeenCalledWith(999, expect.any(Function));
    expect(enrichment.enrichAuthor).not.toHaveBeenCalled();
    expect(enrichment.enrichWork).not.toHaveBeenCalled();
    expect(covers.enqueue).toHaveBeenCalledWith(expect.objectContaining({ path: opus.path, id: opus.id }));
  });
});
