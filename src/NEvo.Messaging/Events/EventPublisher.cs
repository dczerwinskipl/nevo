using NEvo.Messaging.Context;
using NEvo.Messaging.Publishing;

namespace NEvo.Messaging.Events;

public class EventPublisher(
    IMessagePublishStrategyFactory<Event> messagePublishStrategyFactor,
    IMessageContextAccessor messageContextAccessor,
    IMessageContextProvider messageContextFactory
) : IEventPublisher
{
    public Task<Either<Exception, Unit>> PublishAsync(Event @event, CancellationToken cancellationToken)
    {
        var strategy = messagePublishStrategyFactor.CreateFor(@event);
        messageContextAccessor.MessageContext ??= messageContextFactory.CreateContext();
        return strategy.PublishAsync(
            @event,
            messageContextAccessor.MessageContext,
            cancellationToken
        );
    }
}
