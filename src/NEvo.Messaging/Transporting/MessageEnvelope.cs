using NEvo.Messaging.Context;

namespace NEvo.Messaging.Transporting;

public record MessageEnvelope(IMessage Message, IMessageContextHeaders Headers);
