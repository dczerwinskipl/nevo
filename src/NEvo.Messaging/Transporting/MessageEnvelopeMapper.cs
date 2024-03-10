using LanguageExt;

namespace NEvo.Messaging.Transporting;

public class MessageEnvelopeMapper : IMessageEnvelopeMapper
{
    private readonly IMessageSerializer _messageSerializer;

    public MessageEnvelopeMapper(IMessageSerializer messageSerializer)
    {
        _messageSerializer = messageSerializer;
    }

    public Either<Exception, MessageEnvelope> ToMessageEnvelope(MessageEnvelopeDto messageEnvelopeDto)
        => _messageSerializer
                .Deserialize(messageEnvelopeDto.Payload, messageEnvelopeDto.MessageType)
                .Map(message => new MessageEnvelope(message, new MessageContextHeaders(messageEnvelopeDto.Headers.ToDictionary())));

    public Either<Exception, MessageEnvelopeDto> ToMessageEnvelopeDTO(MessageEnvelope messageEnvelope)
        => _messageSerializer
                .Serialize(messageEnvelope.Message)
                .Map(result => new MessageEnvelopeDto(result.MessageType, result.Payload, messageEnvelope.Headers));
}
