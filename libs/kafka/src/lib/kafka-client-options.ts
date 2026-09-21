import { KafkaConfig } from 'kafkajs';

// Local dev talks to the plaintext Kafka container from docker-compose. Managed brokers
// (Upstash, Confluent Cloud, etc.) require SASL_SSL, so SSL/SASL only turn on once
// KAFKA_USERNAME/KAFKA_PASSWORD are set (e.g. via Render env vars) rather than being
// hardcoded per environment.
export function getKafkaClientConfig(clientId: string): KafkaConfig {
  const brokers = (process.env.KAFKA_BROKER || 'localhost:9092')
    .split(',')
    .map((broker) => broker.trim());

  const username = process.env.KAFKA_USERNAME;
  const password = process.env.KAFKA_PASSWORD;

  if (!username || !password) {
    return { clientId, brokers };
  }

  return {
    clientId,
    brokers,
    ssl: true,
    sasl: {
      mechanism:
        (process.env.KAFKA_SASL_MECHANISM as 'scram-sha-256') ||
        'scram-sha-256',
      username,
      password,
    },
  };
}
