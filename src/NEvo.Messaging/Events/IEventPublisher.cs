using NEvo.Messaging.CQRS.Events;

namespace NEvo.Messaging.Events;

public interface IEventPublisher
{
    public Task PublishAsync(Event @event);
}
