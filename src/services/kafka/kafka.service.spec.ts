import { parseKafkaBrokers } from './kafka.service';

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
