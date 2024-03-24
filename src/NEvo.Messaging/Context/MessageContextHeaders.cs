using NEvo.Core;

namespace NEvo.Messaging.Context;

public class MessageContextHeaders(IDictionary<string, string> dictionary) : Dictionary<string, string>(Check.Null(dictionary)), IMessageContextHeaders
{
    public const string CorrelationIdKey = nameof(CorrelationId);
    public const string CausationIdKey = nameof(CausationId);

    public Option<string> CorrelationId
    {
        get
        {
            return TryGetValue(CorrelationIdKey, out var correlationId) ? correlationId : Option<string>.None;
        }
        set
        {
            value.Match(
                some =>
                {
                    this[CorrelationIdKey] = some;
                },
                () =>
                {
                    Remove(CorrelationIdKey);
                }
            );
        }
    }
    public Option<string> CausationId
    {
        get
        {
            return TryGetValue(CausationIdKey, out var causationId) ? causationId : Option<string>.None;
        }
        set
        {
            value.Match(
                some =>
                {
                    this[CausationIdKey] = some;
                },
                () =>
                {
                    Remove(CausationIdKey);
                }
            );
        }
    }
}
