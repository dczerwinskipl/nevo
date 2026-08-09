using Microsoft.Extensions.Logging;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Cqrs.Queries;

public class QueryHandlerAdapterFactory(ILogger<MessageHandlerAdapter> logger) : IMessageHandlerFactory
{
    public Type ForInterface => typeof(IQueryHandler<,>);

    public IMessageHandler Create(MessageHandlerDescription messageHandlerDescription)
        => new MessageHandlerAdapter(messageHandlerDescription, logger);

    public IEnumerable<MessageHandlerDescription> GetMessageHandlerDescriptions(Type handlerType, Type handlerInterface)
    {
        var genericArguments = handlerInterface.GetGenericArguments();
        var queryType = genericArguments[0];
        var resultType = genericArguments[1];

        yield return new MessageHandlerDescription(
            Key: $"{handlerType.FullName}-{queryType.FullName}",
            HandlerType: handlerType,
            MessageType: queryType,
            InterfaceType: handlerInterface,
            ReturnType: resultType,
            Method: handlerType.GetInterfaceMap(handlerInterface).TargetMethods.First(m => m.Name == nameof(IQueryHandler<Query<object>, object>.HandleAsync))
        );
    }
}
