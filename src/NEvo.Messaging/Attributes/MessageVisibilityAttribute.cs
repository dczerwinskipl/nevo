using System.Diagnostics.CodeAnalysis;

namespace NEvo.Messaging.Attributes;

[ExcludeFromCodeCoverage]
[AttributeUsage(AttributeTargets.Class, AllowMultiple = true, Inherited = true)]
public abstract class MessageVisibilityAttribute : Attribute
{
    public abstract bool IsPrivate { get; }
}
