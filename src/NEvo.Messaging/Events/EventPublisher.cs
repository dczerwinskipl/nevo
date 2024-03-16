using NEvo.Messaging.CQRS.Events;

namespace NEvo.Messaging.Events;

public class EventPublisher : IEventPublisher
{
    private IMessagePublishStrategyFactory<Event> _eventPublishStrategyFactor;

    public EventPublisher(IMessagePublishStrategyFactory<Event> eventPublishStrategyFactor)
    {
        _eventPublishStrategyFactor = eventPublishStrategyFactor;
    }

    public Task PublishAsync(Event @event)
    {
        var strategy = _eventPublishStrategyFactor.CreateFor(@event);
        return strategy.PublishAsync(@event);
    }
}
