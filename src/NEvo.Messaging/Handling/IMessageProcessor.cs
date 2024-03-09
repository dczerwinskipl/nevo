using LanguageExt;

namespace NEvo.Messaging.Handling;

public interface IMessageProcessor
{
    Task<Either<Exception, Unit>> ProcessMessageAsync(IMessage message, IMessageContext context, CancellationToken cancellationToken);
}
