using LanguageExt;

namespace NEvo.Messaging.CQRS.Commands;

public interface ICommandHandler<in TMessage> where TMessage : Command
{
    Task<Either<Exception, Unit>> HandleAsync(TMessage message, IMessageContext messageContext, CancellationToken cancellationToken);
}
