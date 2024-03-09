namespace NEvo.Messaging.Transporting;

public record MessageEnvelope(IMessage Message, IMessageContext Context);
