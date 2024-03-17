namespace NEvo.Messaging.Transporting;

public interface IMessageSerializer
{
    Either<Exception, (string Payload, string MessageType)> Serialize(IMessage message);
    Either<Exception, IMessage> Deserialize(string payload, string messageType);
}
