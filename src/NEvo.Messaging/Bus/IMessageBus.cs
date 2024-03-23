using NEvo.Messaging.Context;

namespace NEvo.Messaging.Bus;

public interface IMessageBus
{
    Task<Either<Exception, Unit>> PublishAsync(IMessage message, IMessageContext messageContext, CancellationToken cancellationToken);
}
