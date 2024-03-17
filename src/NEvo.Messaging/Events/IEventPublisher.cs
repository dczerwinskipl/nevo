namespace NEvo.Messaging.Events;

public interface IEventPublisher
{
    Task PublishAsync(Event @event, CancellationToken cancellationToken);
}
