using LanguageExt;

namespace NEvo.Messaging.Transporting;

public class MessageEnvelopeMapper : IMessageEnvelopeMapper
{
    private readonly IMessageSerializer _messageSerializer;

    public MessageEnvelopeMapper(IMessageSerializer messageSerializer)
    {
        _messageSerializer = messageSerializer;
    }

    public Either<Exception, MessageEnvelope> ToMessageEnvelope(MessageEnvelopeDTO messageEnvelope)
        => _messageSerializer
                .Deserialize(messageEnvelope.Payload, messageEnvelope.MessageType)
                .Map(message => new MessageEnvelope(message, new MessageContext(messageEnvelope.Headers)));

    public Either<Exception, MessageEnvelopeDTO> ToMessageEnvelopeDTO(MessageEnvelope messageEnvelope)
        => _messageSerializer
                .Serialize(messageEnvelope.Message)
                .Map(result => new MessageEnvelopeDTO(result.MessageType, result.Payload, messageEnvelope.Context.Headers));
}
