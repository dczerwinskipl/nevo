using NEvo.Messaging.Context;

namespace NEvo.Messaging.Dispatching;

public interface IMessageDispatchStrategy
{
    Task<Either<Exception, Unit>> DispatchAsync(IMessage message, IMessageContext messageContext, CancellationToken cancellationToken);
    Task<Either<Exception, TResult>> DispatchAsync<TResult>(IMessage<TResult> message, IMessageContext messageContext, CancellationToken cancellationToken);
}