using NEvo.Messaging.Context;
using System.Linq;

namespace NEvo.Messaging.Transporting;

public class MessageEnvelopeMapper(IMessageSerializer messageSerializer) : IMessageEnvelopeMapper
{
    public Either<Exception, MessageEnvelope> ToMessageEnvelope(MessageEnvelopeDto messageEnvelopeDto)
        => messageSerializer
                .DeserializeMessage(messageEnvelopeDto.Payload, messageEnvelopeDto.MessageType)
                .Map(message => new MessageEnvelope(
                    message,
                    messageSerializer
                        .DeserializeHeaders(messageEnvelopeDto.Headers)
                        .IfLeft(_ => new MessageContextHeaders(new Dictionary<string, string>()))
                 ));

    public Either<Exception, MessageEnvelopeDto> ToMessageEnvelopeDTO(MessageEnvelope messageEnvelope)
        => messageSerializer
                .Serialize(messageEnvelope.Message)
                .Map(result => new MessageEnvelopeDto(
                    messageEnvelope.Message.Id,
                    result.MessageType,
                    result.Payload,
                    messageSerializer
                        .SerializeHeaders(messageEnvelope.Headers)
                        .IfLeft(string.Empty),
                    "..." // gey Partition Kery
                ));
}
