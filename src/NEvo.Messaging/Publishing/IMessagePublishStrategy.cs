using NEvo.Messaging.Context;

namespace NEvo.Messaging.Publish;

public interface IMessagePublishStrategy
{
    Task<Either<Exception, Unit>> PublishAsync(IMessage message, IMessageContext messageContext, CancellationToken cancellationToken);
}
