namespace NEvo.Messaging.Transporting;

public interface IMessageEnvelopeMapper
{
    Either<Exception, MessageEnvelope> ToMessageEnvelope(MessageEnvelopeDto messageEnvelopeDto);
    Either<Exception, MessageEnvelopeDto> ToMessageEnvelopeDTO(MessageEnvelope messageEnvelope);
}
