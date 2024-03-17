namespace NEvo.Messaging;

public interface IMessageDispatchStrategy
{
    Task<Either<Exception, Unit>> DispatchAsync(IMessage message, CancellationToken cancellationToken);
    Task<Either<Exception, TResult>> DispatchAsync<TResult>(IMessage<TResult> message, CancellationToken cancellationToken);
}