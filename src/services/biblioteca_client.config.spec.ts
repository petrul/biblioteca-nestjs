import { BibliotecaClient } from './biblioteca_client.service';

// getConfig() copies biblioteca-server's /api/admin/config field by field, so a
// topic the server adds is invisible here until it is copied too - which is how
// biblioteca_events went unpublished from this service at first (2026-10-29).
describe('BibliotecaClient.getConfig', () => {
  it('passes on every Kafka topic the server names, the human-events topic included', async () => {
    const client = new BibliotecaClient({ bibliotecaUrl: 'http://server.test' } as any);
    (client as any).tb = { api: { config: async () => ({ data: {
      kafka: {
        newOpusImportedTopic: 'biblioteca_newOpusImportedTopic', opusReimportedTopic: 'biblioteca_opusReimportedTopic',
        opusRemovedTopic: 'biblioteca_opusRemovedTopic', enrichWorkTopic: 'biblioteca_enrichWorkTopic',
        humanEventsTopic: 'biblioteca_events',
      },
      milvus: { collection: 'paragraphs' },
      embedder: { model: 'bge-m3', dimension: 1024 },
    } }) } };

    const config = await client.getConfig();

    expect(config.kafka).toEqual({
      newOpusImportedTopic: 'biblioteca_newOpusImportedTopic', opusReimportedTopic: 'biblioteca_opusReimportedTopic',
      opusRemovedTopic: 'biblioteca_opusRemovedTopic', enrichWorkTopic: 'biblioteca_enrichWorkTopic',
      humanEventsTopic: 'biblioteca_events',
    });
  });
});
