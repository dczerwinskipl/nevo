namespace NEvo.Messaging.Events;

public class EventPublisher(IMessagePublishStrategyFactory<Event> messagePublishStrategyFactor) : IEventPublisher
{
    public Task<Either<Exception, Unit>> PublishAsync(Event @event, CancellationToken cancellationToken)
    {
        var strategy = messagePublishStrategyFactor.CreateFor(@event);
        return strategy.PublishAsync(@event, cancellationToken);
    }
}
