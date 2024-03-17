namespace NEvo.Messaging.Events;

public interface IEventPublisher
{
    Task<Either<Exception, Unit>> PublishAsync(Event @event, CancellationToken cancellationToken);
}
