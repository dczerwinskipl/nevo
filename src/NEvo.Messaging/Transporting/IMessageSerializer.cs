using NEvo.Messaging.Context;

namespace NEvo.Messaging.Transporting;

public interface IMessageSerializer
{
    Either<Exception, (string Payload, string MessageType)> Serialize(IMessage message);
    Either<Exception, IMessage> DeserializeMessage(string payload, string messageType);
    Either<Exception, string> SerializeHeaders(IMessageContextHeaders message);
    Either<Exception, IMessageContextHeaders> DeserializeHeaders(string headers);
}
