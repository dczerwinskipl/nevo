namespace NEvo.Messaging.Transporting;

public record MessageEnvelopeDto(string MessageType, string Payload, IReadOnlyDictionary<string, string> Headers);
