namespace NEvo.Messaging.Handling;

public interface IMessageProcessor
{
    Task<Either<Exception, Unit>> ProcessMessageAsync(IMessage message, IMessageContext context, CancellationToken cancellationToken);
    Task<Either<Exception, TResult>> ProcessMessageAsync<TResult>(IMessage<TResult> message, IMessageContext context, CancellationToken cancellationToken);
}
