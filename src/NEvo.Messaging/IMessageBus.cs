using LanguageExt;

namespace NEvo.Messaging;

public interface IMessageBus
{
    Task<Either<Exception, Unit>> PublishAsync(IMessage message);
    Task<Either<Exception, Unit>> DispatchAsync(IMessage message);
    Task<Either<Exception, TResult>> DispatchAsync<TResult>(IMessage<TResult> message);
}
