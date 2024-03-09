using LanguageExt;

namespace NEvo.Messaging.Transporting;

public interface IMessageEnvelopeMapper
{
    Either<Exception, MessageEnvelope> ToMessageEnvelope(MessageEnvelopeDTO messageEnvelope);
    Either<Exception, MessageEnvelopeDTO> ToMessageEnvelopeDTO(MessageEnvelope messageEnvelope);
}
