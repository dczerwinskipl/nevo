namespace NEvo.Messaging;

public interface IMessageBus
{
    Task<Either<Exception, Unit>> PublishAsync(IMessage message, CancellationToken cancellationToken);
}
