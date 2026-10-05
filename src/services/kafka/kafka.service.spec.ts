import { KafkaService, parseKafkaBrokers } from './kafka.service';

describe('parseKafkaBrokers', () => {
  it('keeps a single broker', () => {
    expect(parseKafkaBrokers('mini.local:9092')).toEqual([
      'mini.local:9092',
    ]);
  });

  it('splits and trims multiple brokers', () => {
    expect(
      parseKafkaBrokers(
        'zmeu.local:9092, srv2.local:9092,mini.local:9092',
      ),
    ).toEqual([
      'zmeu.local:9092',
      'srv2.local:9092',
      'mini.local:9092',
    ]);
  });
});

// A fresh Kafka broker has no biblioteca_* topics, and a consumer's
// metadata request never triggers the broker's own auto-create (that fires
// on produce only) - ensureTopics is what lets this worker boot against a
// fresh broker instead of dying with "This server does not host this
// topic-partition".
describe('KafkaService.ensureTopics', () => {
  function serviceWithAdmin(admin: any): KafkaService {
    const svc = new KafkaService({ kafkaServers: 'srv2.local:20106' } as any);
    jest.spyOn(svc.kafka, 'admin').mockReturnValue(admin);
    return svc;
  }

  function fakeAdmin(createTopics: any) {
    return {
      connect: jest.fn().mockResolvedValue(undefined),
      createTopics,
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
  }

  it('creates the given topics on a fresh broker', async () => {
    const createTopics = jest.fn().mockResolvedValue(true);
    const admin = fakeAdmin(createTopics);
    await serviceWithAdmin(admin).ensureTopics(['biblioteca_newOpusImportedTopic']);
    expect(createTopics).toHaveBeenCalledWith({
      topics: [{ topic: 'biblioteca_newOpusImportedTopic', numPartitions: 1, replicationFactor: 1 }],
      waitForLeaders: false,
    });
    expect(admin.disconnect).toHaveBeenCalled();
  });

  it('treats an already-existing topic as success, not an error', async () => {
    const createTopics = jest.fn().mockRejectedValue(
      new Error("Topic 'biblioteca_newOpusImportedTopic' already exists."),
    );
    const admin = fakeAdmin(createTopics);
    await expect(
      serviceWithAdmin(admin).ensureTopics(['biblioteca_newOpusImportedTopic']),
    ).resolves.toBeUndefined();
    expect(admin.disconnect).toHaveBeenCalled();
  });

  it('propagates real broker errors and still disconnects the admin', async () => {
    const createTopics = jest.fn().mockRejectedValue(new Error('broker unreachable'));
    const admin = fakeAdmin(createTopics);
    await expect(
      serviceWithAdmin(admin).ensureTopics(['biblioteca_newOpusImportedTopic']),
    ).rejects.toThrow('broker unreachable');
    expect(admin.disconnect).toHaveBeenCalled();
  });
});
