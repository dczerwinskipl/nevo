using NEvo.Messaging.Context;

namespace NEvo.Messaging.Handling.Strategies;

public class MessageProcessingStrategyFactory : IMessageProcessingStrategyFactory
{
    private readonly IEnumerable<IMessageProcessingStrategy> _messageProcessingStrategies;
    private readonly IEnumerable<IMessageProcessingStrategyWithResult> _messageProcessingStrategiesWithResult;

    public MessageProcessingStrategyFactory(IEnumerable<IMessageProcessingStrategy> messageProcessingStrategies, IEnumerable<IMessageProcessingStrategyWithResult> messageProcessingStrategiesWithResult)
    {
        _messageProcessingStrategies = messageProcessingStrategies;
        _messageProcessingStrategiesWithResult = messageProcessingStrategiesWithResult;
    }

    public IMessageProcessingStrategy CreateForMessage(IMessage message, IMessageContext messageContext) => 
        _messageProcessingStrategies.First(s => s.ShouldApply(message, messageContext));

    public IMessageProcessingStrategyWithResult CreateForMessageWithResult<TResult>(IMessage<TResult> message, IMessageContext messageContext) => 
        _messageProcessingStrategiesWithResult.First(s => s.ShouldApply(message, messageContext));
}