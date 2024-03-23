namespace NEvo.Messaging.Transporting;

public record MessageEnvelopeDto(Guid MessageId, string MessageType, string Payload, string Headers);
