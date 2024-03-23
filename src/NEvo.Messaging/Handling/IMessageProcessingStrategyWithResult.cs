using NEvo.Messaging.Context;

namespace NEvo.Messaging.Handling;

public interface IMessageProcessingStrategyWithResult
{
    bool ShouldApply<TResult>(IMessage<TResult> message, IMessageContext context);
    Task<Either<Exception, TResult>> ProcessMessageWithResultAsync<TResult>(IMessage<TResult> message, IMessageContext context, CancellationToken cancellationToken);
}