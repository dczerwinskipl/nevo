using NEvo.Messaging.Context;

namespace NEvo.Messaging.Transporting;

public class MessageEnvelopeMapper(IMessageSerializer messageSerializer) : IMessageEnvelopeMapper
{
    public Either<Exception, MessageEnvelope> ToMessageEnvelope(MessageEnvelopeDto messageEnvelopeDto)
        => messageSerializer
                .DeserializeMessage(messageEnvelopeDto.Payload, messageEnvelopeDto.MessageType)
                .Map(message => new MessageEnvelope(
                    message,
                    messageEnvelopeDto.Headers ?? []
                 ));

    public Either<Exception, MessageEnvelopeDto> ToMessageEnvelopeDTO(MessageEnvelope messageEnvelope)
        => messageSerializer
                .Serialize(messageEnvelope.Message)
                .Map(result => new MessageEnvelopeDto(
                    messageEnvelope.Message.Id,
                    result.MessageType,
                    result.Payload,
                    messageEnvelope.Headers ?? [],
                    null // TODO: get Partition Key
                ));
}
