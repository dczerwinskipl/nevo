using LanguageExt;

namespace NEvo.Messaging;

public interface IMessageContext
{
    public IMessageContextHeaders Headers { get; }
    public Option<string> CorrelationId => Headers.CorrelationId;
    public Option<string> CausationId => Headers.CausationId;
}
