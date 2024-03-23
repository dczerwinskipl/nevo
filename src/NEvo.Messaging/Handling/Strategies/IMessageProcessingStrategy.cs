using NEvo.Messaging.Context;

namespace NEvo.Messaging.Handling.Strategies;

public interface IMessageProcessingStrategy
{
    bool ShouldApply(IMessage message, IMessageContext context);
    Task<Either<Exception, Unit>> ProcessMessageAsync(IMessage message, IMessageContext context, CancellationToken cancellationToken);
}
