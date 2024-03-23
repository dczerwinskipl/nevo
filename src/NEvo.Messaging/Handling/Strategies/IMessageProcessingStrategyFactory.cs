using NEvo.Messaging.Context;

namespace NEvo.Messaging.Handling.Strategies;

public interface IMessageProcessingStrategyFactory
{
    IMessageProcessingStrategy CreateForMessage(IMessage message, IMessageContext messageContext);

    IMessageProcessingStrategyWithResult CreateForMessageWithResult<TResult>(IMessage<TResult> message, IMessageContext messageContext);
}


public class MessageProcessingStrategyFactory : IMessageProcessingStrategyFactory
{
    private readonly IEnumerable<IMessageProcessingStrategy> _messageProcessingStrategies;
    private readonly IEnumerable<IMessageProcessingStrategyWithResult> _messageProcessingStrategiesWithResult;

    public MessageProcessingStrategyFactory(IEnumerable<IMessageProcessingStrategy> messageProcessingStrategies, IEnumerable<IMessageProcessingStrategyWithResult> messageProcessingStrategiesWithResult)
    {
        _messageProcessingStrategies = messageProcessingStrategies;
        _messageProcessingStrategiesWithResult = messageProcessingStrategiesWithResult;
    }

    public IMessageProcessingStrategy CreateForMessage(IMessage message, IMessageContext messageContext)
    {
        return _messageProcessingStrategies.Where(s => s.ShouldApply(message, messageContext)).First(); //TODO: change to optional
    }

    public IMessageProcessingStrategyWithResult CreateForMessageWithResult<TResult>(IMessage<TResult> message, IMessageContext messageContext)
    {
        return _messageProcessingStrategiesWithResult.Where(s => s.ShouldApply(message, messageContext)).First(); //TODO: change to optional
    }
}