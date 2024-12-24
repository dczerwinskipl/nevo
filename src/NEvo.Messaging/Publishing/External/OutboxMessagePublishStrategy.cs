using NEvo.Messaging.Context;
using NEvo.Messaging.Transporting;

namespace NEvo.Messaging.Publishing.External;

public class OutboxMessagePublishStrategy(IMessageOutbox messageOutbox, IMessageEnvelopeMapper messageEnvelopeMapper) : IExternalMessagePublishStrategy
{
    public Task<Either<Exception, Unit>> PublishAsync(IMessage message, IMessageContext messageContext, CancellationToken cancellationToken) =>
        messageEnvelopeMapper
            .ToMessageEnvelopeDTO(new MessageEnvelope(message, messageContext.Headers))
            .MapAsync(messageOutbox.SaveMessageAsync);
}
