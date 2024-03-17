using NEvo.Messaging.Cqrs.Events;

namespace NEvo.Messaging.Events;

public interface IEventPublisher
{
    Task PublishAsync(Event @event, CancellationToken cancellationToken);
}
