namespace NEvo.Messaging.Transporting;

public record MessageEnvelopeDTO(string MessageType, string Payload, IReadOnlyDictionary<string, string> Headers);
