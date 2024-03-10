using LanguageExt;
using NEvo.Messaging.Handling;
using System.Reflection;

namespace NEvo.Messaging;

public abstract class MessageHandlerAdapterBase<TMessageGroup> : IMessageHandler
{
    private readonly MethodInfo _genericInternalHandleAsyncMethod;
    public MessageHandlerDescription HandlerDescription { get; init; }
    
    public MessageHandlerAdapterBase(MessageHandlerDescription messageHandlerDescription) : base()
    {
        HandlerDescription = messageHandlerDescription;
        _genericInternalHandleAsyncMethod = GetType().GetMethod(nameof(InternalHandleAsync), BindingFlags.NonPublic | BindingFlags.Instance)!.MakeGenericMethod(messageHandlerDescription.MessageType);
    }

    public async Task<Either<Exception, object>> HandleAsync(IMessage message, IMessageContext context, CancellationToken cancellationToken)
    {
        var result = await (Task<Either<Exception, Unit>>)_genericInternalHandleAsyncMethod.Invoke(this, new object[] { message, context, cancellationToken })!;

        var objectResult = result.Map(unit => (object)unit);

        return objectResult;
    }

    protected abstract Task<Either<Exception, Unit>> InternalHandleAsync<TMessage>(TMessage message, IMessageContext context, CancellationToken cancellationToken) where TMessage : TMessageGroup;
}