using NEvo.Messaging.Context;
using NEvo.Messaging.Transporting;

namespace NEvo.Messaging.Publishing.External;

public class OutboxMessagePublishStrategy(IMessageOutbox messageOutbox, IMessageContextProvider messageContextFactory, IMessageEnvelopeMapper messageEnvelopeMapper) : IExternalMessagePublishStrategy
{
    public Task<Either<Exception, Unit>> PublishAsync(IMessage message, CancellationToken cancellationToken) => 
        messageEnvelopeMapper
            .ToMessageEnvelopeDTO(new MessageEnvelope(message, messageContextFactory.CreateHeaders()))
            .MapAsync(messageOutbox.SaveMessageAsync);
}
