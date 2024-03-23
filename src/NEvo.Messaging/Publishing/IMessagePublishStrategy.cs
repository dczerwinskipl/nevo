namespace NEvo.Messaging.Publish;

public interface IMessagePublishStrategy
{
    Task<Either<Exception, Unit>> PublishAsync(IMessage message, CancellationToken cancellationToken);
}
