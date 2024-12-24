using NEvo.Messaging.Context;
using System.Text.Json;

namespace NEvo.Messaging.Transporting;

public class DefaultMessageSerializer(IMessageTypeMapper messageTypeMapper) : IMessageSerializer
{
    public Either<Exception, IMessage> DeserializeMessage(string payload, string messageType)
    {
        try
        {
            return messageTypeMapper.ToType(messageType).Match(
                (Type type) =>
                {
                    var message = JsonSerializer.Deserialize(json: payload, returnType: type) as IMessage;
                    if (message is null)
                    {
                        return Either<Exception, IMessage>.Left(new InvalidOperationException("Deserialized object is empty"));
                    }
                    return Either<Exception, IMessage>.Right(message);
                },
                () => Either<Exception, IMessage>.Left(new InvalidOperationException($"Type {messageType} could not be resolved."))
            );
        }
        catch (Exception exc)
        {
            return exc;
        }
    }

    public Either<Exception, (string Payload, string MessageType)> Serialize(IMessage message)
    {
        try
        {
            return messageTypeMapper.ToName(message.GetType()).Match(
                (string messageType) =>
                {
                    var serializedMessage = JsonSerializer.Serialize(message, message.GetType());
                    return Either<Exception, (string Payload, string MessageType)>.Right((serializedMessage, messageType));
                },
                () => Either<Exception, (string Payload, string MessageType)>.Left(new InvalidOperationException($"Cannot map type to name"))
            );
        }
        catch (Exception exc)
        {
            return exc;
        }
    }
}