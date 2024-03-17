using LanguageExt;

namespace NEvo.Messaging.Cqrs.Events;

public interface IEventHandler<in TMessage> where TMessage : Event
{
    Task<Either<Exception, Unit>> HandleAsync(TMessage message, IMessageContext messageContext, CancellationToken cancellationToken);
}
