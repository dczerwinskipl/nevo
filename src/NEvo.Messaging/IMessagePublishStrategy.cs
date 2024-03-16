using LanguageExt;

namespace NEvo.Messaging;

public interface IMessagePublishStrategy
{
    public Task<Either<Exception, Unit>> PublishAsync(IMessage message);
}

