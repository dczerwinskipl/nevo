using LanguageExt;

namespace NEvo.Messaging;

public interface IMessagePublishStrategy
{
    Task<Either<Exception, Unit>> PublishAsync(IMessage message, CancellationToken cancellationToken);
}
