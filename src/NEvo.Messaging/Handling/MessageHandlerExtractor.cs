using Microsoft.Extensions.Options;

namespace NEvo.Messaging.Handling;

public class MessageHandlerExtractorConfiguration
{
    public System.Collections.Generic.HashSet<Type> Handlers { get; } = [];
}

public class MessageHandlerExtractor(
    IEnumerable<IMessageHandlerFactory> factories,
    IOptions<MessageHandlerExtractorConfiguration> options
) : IMessageHandlerProvider
{
    private readonly MessageHandlerExtractorConfiguration _configuration = options.Value;
    private readonly Dictionary<Type, IMessageHandlerFactory> _factories = factories.ToDictionary(f => f.ForInterface);

    public IDictionary<Type, IEnumerable<IMessageHandler>> GetMessageHandlers()
        => _configuration.Handlers
            .SelectMany(handlerType =>
                handlerType
                    .GetInterfaces()
                    .Where(handlerInterface => handlerInterface.IsGenericType && _factories.ContainsKey(handlerInterface.GetGenericTypeDefinition()))
                    .Select(handlerInterface => (handlerType, handlerInterface, _factories[handlerInterface.GetGenericTypeDefinition()]))
                    .SelectMany(CreateMessageHandler)
            )
            .GroupBy(x => x.MessageType)
            .ToDictionary(g => g.Key, g => g.Select(x => x.MessageHandler));

    private IEnumerable<(Type MessageType, IMessageHandler MessageHandler)> CreateMessageHandler((Type handlerType, Type HandlerInterface, IMessageHandlerFactory Factory) input)
    {
        foreach (var messageHandlerDescription in input.Factory.GetMessageHandlerDescriptions(input.handlerType, input.HandlerInterface))
        {
            var handler = input.Factory.Create(messageHandlerDescription);
            yield return (messageHandlerDescription.MessageType, handler);
        }
    }
}