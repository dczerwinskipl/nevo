using NEvo.Messaging.Context;

namespace NEvo.Messaging.Cqrs.Commands;

public interface ICommandHandler<in TMessage> where TMessage : Command
{
    Task<Either<Exception, Unit>> HandleAsync(TMessage message, IMessageContext messageContext, CancellationToken cancellationToken);
}
